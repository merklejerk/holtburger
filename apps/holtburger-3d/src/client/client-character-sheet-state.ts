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

/** Session-owned character facts and correlated quotes; UI samples by revision. */
export class ClientCharacterSheetState {
	#sheet: CharacterSheet | null = null;
	#quotes = new Map<string, ProgressionEvaluation>();
	#pending = new Map<string, ProgressionQuote>();
	#requestId = 0;
	#revision = 0;
	#feedback: string | null = null;

	constructor(
		private readonly evaluate: (
			requestId: number,
			intents: readonly ProgressionIntent[],
		) => Promise<void>,
		private readonly submit: (quote: ProgressionQuote) => Promise<void>,
	) {}

	read(): {
		readonly revision: number;
		readonly sheet: CharacterSheet | null;
		readonly evaluations: ReadonlyMap<string, ProgressionEvaluation>;
		readonly pendingTargets: ReadonlySet<string>;
		readonly feedback: string | null;
	} {
		return {
			revision: this.#revision,
			sheet: this.#sheet,
			evaluations: this.#quotes,
			pendingTargets: new Set(this.#pending.keys()),
			feedback: this.#feedback,
		};
	}

	/** A replacement snapshot retires every old quote, even for the same GUID. */
	reset(sheet: CharacterSheet | null): void {
		this.#requestId++;
		this.#quotes = new Map();
		this.#pending.clear();
		this.#feedback = null;
		this.#sheet = sheet;
		this.#revision++;
		this.#requestQuotes();
	}

	/** Preserve quotes across pool/buff changes; target and resource changes reprice. */
	replace(sheet: CharacterSheet | null): void {
		if (sheet === null || this.#sheet?.character !== sheet.character) {
			this.reset(sheet);
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
			this.#feedback = `Purchase was not sent: ${JSON.stringify(feedback.Rejected.reason)}`;
			this.#requestQuotes();
		} else if ("DispatchFailed" in feedback) {
			this.#feedback = `Purchase send failed: ${feedback.DispatchFailed.message}`;
		}
		this.#revision++;
	}

	async purchase(quote: ProgressionQuote): Promise<void> {
		const sheet = this.#sheet;
		if (sheet === null || sheet.character !== quote.quote.character) return;
		const key = progressionTargetKey(progressionTarget(quote.quote.intent));
		if (
			this.#pending.has(key) ||
			sheet.guardedTargets.some(
				(target) => progressionTargetKey(target) === key,
			)
		)
			return;
		this.#pending.set(key, quote);
		this.#feedback = null;
		this.#revision++;
		try {
			await this.submit(quote);
		} catch (error) {
			// Reset or an authoritative target change may retire this purchase while
			// the bridge is still settling. Its failure cannot belong to that new state.
			if (this.#pending.get(key) !== quote) return;
			// A bridge failure cannot prove whether the host queued the action.
			this.#feedback = `Purchase submission failed; awaiting a server update: ${String(error)}`;
			this.#revision++;
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
		const sheet = this.#sheet;
		if (sheet === null) return;
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
		const requestId = ++this.#requestId;
		this.#quotes = new Map();
		this.#revision++;
		void this.evaluate(requestId, intents).catch((error) => {
			if (requestId !== this.#requestId) return;
			this.#feedback = `Unable to evaluate purchases: ${String(error)}`;
			this.#revision++;
		});
	}
}
