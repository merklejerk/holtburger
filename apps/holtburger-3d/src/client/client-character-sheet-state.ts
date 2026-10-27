import {
	progressionIntentKey,
	progressionTarget,
	progressionTargetKey,
	type CharacterSheet,
	type ProgressionEvaluation,
	type ProgressionFeedback,
	type ProgressionIntent,
	type ProgressionQuote,
	type StatTarget,
} from "./client-character-sheet-contract";
import type { ClientLifecycle } from "./client-host-contract";
import { progressionRejectionReason } from "./client-character-sheet-feedback";

/** Session-owned character facts and correlated quotes; UI samples by revision. */
export class ClientCharacterSheetState {
	#sheet: CharacterSheet | null = null;
	/** Lifecycle gates purchase evaluation independently of retained character facts. */
	#phase: ClientLifecycle["kind"] | null = null;
	#quotes = new Map<string, ProgressionEvaluation>();
	#pending = new Map<string, ProgressionQuote>();
	#requestId = 0;
	#revision = 0;

	constructor(
		private readonly evaluate: (
			requestId: number,
			intents: readonly ProgressionIntent[],
		) => Promise<void>,
		private readonly submit: (quote: ProgressionQuote) => Promise<void>,
		private readonly sendTitle: (
			character: number,
			titleId: number,
		) => Promise<void>,
		/** Ephemeral failures use the session's shared action-feedback delivery. */
		private readonly reportFailure: (message: string) => void,
	) {}

	/** Immediate display selection; subsequent snapshots win without confirmation tracking. */
	async selectTitle(titleId: number): Promise<void> {
		const sheet = this.#sheet;
		if (
			sheet === null ||
			sheet.titleSelection === null ||
			sheet.titleSelection.selectedId === titleId
		)
			return;
		this.#sheet = {
			...sheet,
			titleSelection: { ...sheet.titleSelection, selectedId: titleId },
		};
		this.#revision++;
		try {
			await this.sendTitle(sheet.character, titleId);
		} catch (error) {
			if (this.#sheet?.character !== sheet.character) return;
			this.reportFailure(
				`Title selection send failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	read(): {
		readonly revision: number;
		readonly sheet: CharacterSheet | null;
		readonly evaluations: ReadonlyMap<string, ProgressionEvaluation>;
		readonly pendingTargets: ReadonlySet<string>;
		/** Panel explanation while lifecycle prevents offering purchase quotes. */
		readonly progressionUnavailable: string | null;
	} {
		return {
			revision: this.#revision,
			sheet: this.#sheet,
			evaluations: this.#quotes,
			pendingTargets: new Set(this.#pending.keys()),
			progressionUnavailable:
				this.#phase === "portal-space"
					? "Purchases unavailable during portal travel"
					: this.#phase !== "in-world" || this.#sheet === null
						? "Purchases unavailable until the character is ready"
						: null,
		};
	}

	/** A replacement snapshot retires every old quote, even for the same GUID. */
	reset(
		sheet: CharacterSheet | null,
		phase: ClientLifecycle["kind"] | null,
	): void {
		this.#pending.clear();
		this.#sheet = sheet;
		this.#phase = phase;
		this.#requestQuotes();
	}

	/** Withdraw old evaluations on lifecycle changes without retiring attempted purchases. */
	setContext(phase: ClientLifecycle["kind"] | null): void {
		if (phase === this.#phase) return;
		this.#phase = phase;
		this.#requestQuotes();
	}

	/** Preserve quotes across pool/buff changes; target and resource changes reprice. */
	replace(sheet: CharacterSheet | null): void {
		if (sheet === null || this.#sheet?.character !== sheet.character) {
			this.reset(sheet, this.#phase);
			return;
		}
		const before = this.#quoteInputs(this.#sheet);
		this.#sheet = sheet;
		for (const [key, quote] of this.#pending) {
			if (
				!this.#sameTargetState(
					sheet,
					progressionTarget(quote.quote.intent),
					quote,
				)
			) {
				this.#pending.delete(key);
			}
		}
		this.#revision++;
		if (before !== this.#quoteInputs(sheet)) this.#requestQuotes();
	}

	acceptEvaluations(
		requestId: number,
		evaluations: readonly ProgressionEvaluation[],
	): void {
		if (requestId !== this.#requestId || this.#sheet === null) return;
		this.#quotes = new Map(
			evaluations.map((item) => [progressionIntentKey(item.intent), item]),
		);
		this.#revision++;
	}

	acceptFeedback(feedback: ProgressionFeedback): void {
		if ("Rejected" in feedback) {
			this.#pending.delete(
				progressionTargetKey(progressionTarget(feedback.Rejected.intent)),
			);
			this.reportFailure(
				`Purchase was not sent: ${progressionRejectionReason(feedback.Rejected.reason)}`,
			);
			this.#requestQuotes();
		} else if ("DispatchFailed" in feedback) {
			this.reportFailure(
				`Purchase send failed; awaiting a server update: ${feedback.DispatchFailed.message}`,
			);
		}
	}

	async purchase(quote: ProgressionQuote): Promise<void> {
		const sheet = this.#sheet;
		if (
			this.#phase !== "in-world" ||
			sheet === null ||
			sheet.character !== quote.quote.character
		)
			return;
		const key = progressionTargetKey(progressionTarget(quote.quote.intent));
		if (
			this.#pending.has(key) ||
			sheet.guardedTargets.some(
				(target) => progressionTargetKey(target) === key,
			)
		)
			return;
		this.#pending.set(key, quote);
		this.#revision++;
		try {
			await this.submit(quote);
		} catch (error) {
			// Reset or an authoritative target change may retire this purchase while
			// the bridge is still settling. Its failure cannot belong to that new state.
			if (this.#pending.get(key) !== quote) return;
			// A bridge failure cannot prove whether the host queued the action.
			this.reportFailure(
				`Purchase submission failed; awaiting a server update: ${String(error)}`,
			);
		}
	}

	#sameTargetState(
		sheet: CharacterSheet,
		target: StatTarget,
		quote: ProgressionQuote,
	): boolean {
		const state = quote.quote.target_state;
		const stat =
			"Attribute" in target
				? sheet.attributes.find((row) => row.attr_type === target.Attribute)
				: "Vital" in target
					? sheet.vitals.find((row) => row.vital_type === target.Vital)
					: sheet.skills.find((row) => row.stat.skill_type === target.Skill)
							?.stat;
		return (
			stat !== undefined &&
			stat.ranks === state.ranks &&
			stat.spent_xp === state.spent_xp &&
			("training" in stat ? stat.training : null) === state.training
		);
	}

	#quoteInputs(sheet: CharacterSheet): string {
		return JSON.stringify([
			sheet.character,
			sheet.level.unspentXp,
			sheet.level.unspentSkillPoints,
			sheet.attributes.map((row) => [row.attr_type, row.ranks, row.spent_xp]),
			sheet.vitals.map((row) => [row.vital_type, row.ranks, row.spent_xp]),
			sheet.skills.map((row) => [
				row.stat.skill_type,
				row.stat.training,
				row.stat.ranks,
				row.stat.spent_xp,
			]),
		]);
	}

	#requestQuotes(): void {
		// Invalidate replies even when no new request is allowed during this phase.
		const requestId = ++this.#requestId;
		this.#quotes = new Map();
		this.#revision++;
		const sheet = this.#sheet;
		if (sheet === null || this.#phase !== "in-world") return;
		const targets: StatTarget[] = [
			...sheet.attributes.map((row) => ({ Attribute: row.attr_type })),
			...sheet.vitals.map((row) => ({ Vital: row.vital_type })),
			...sheet.skills
				.filter((row) => row.availableInEor && row.stat.training !== "Unusable")
				.map((row) => ({ Skill: row.stat.skill_type })),
		];
		const intents: ProgressionIntent[] = targets.flatMap(
			(target): ProgressionIntent[] => {
				if (
					"Skill" in target &&
					sheet.skills.find((row) => row.stat.skill_type === target.Skill)?.stat
						.training === "Untrained"
				) {
					return [{ Train: { skill: target.Skill } }];
				}
				return [
					{ Raise: { target, ranks: 1 } },
					{ Raise: { target, ranks: 10 } },
					{ RaiseMax: { target } },
				];
			},
		);
		void this.evaluate(requestId, intents).catch((error) => {
			if (requestId !== this.#requestId) return;
			this.reportFailure(`Unable to evaluate purchases: ${String(error)}`);
		});
	}
}
