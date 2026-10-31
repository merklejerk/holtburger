import type {
	BarberChoices,
	BarberPreview,
	BarberSnapshot,
} from "./client-barber-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

/** Only semantic choices and cold readiness enter the HUD's reactive graph. */
export interface BarberView {
	readonly interaction: BarberSnapshot["interaction"];
	readonly choices: BarberChoices | null;
	readonly pending: boolean;
	/** Controls remain usable during preview preparation, but freeze on Apply. */
	readonly canEdit: boolean;
	readonly canApply: boolean;
	readonly problem: string | null;
}

type BarberSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "barberSnapshot" | "requestBarber"
>;

/** App-owned editor; core owns rules, admission, interaction lifetime, and submission. */
export class ClientBarberState {
	readonly #session: BarberSession;
	readonly #report: (message: string) => void;
	readonly #present: (preview: BarberPreview | null) => Promise<void>;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<() => void>();
	#snapshot: BarberSnapshot;
	#choices: BarberChoices | null = null;
	#revision = 0;
	#installed = -1;
	#lastGoodPreview: BarberPreview | null = null;
	#pending: number | null = null;
	#submitting = false;
	#problem: string | null = null;
	#closed = false;
	#retiredOpening = 0;

	constructor(
		session: BarberSession,
		present: (preview: BarberPreview | null) => Promise<void>,
		report: (message: string) => void,
	) {
		this.#session = session;
		this.#present = present;
		this.#report = report;
		this.#snapshot = { interaction: null, result: null, particles: null };
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
		this.#accept(session.barberSnapshot());
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	read(): BarberView {
		return {
			interaction: this.#snapshot.interaction,
			choices: this.#choices,
			pending: this.#pending !== null || this.#submitting,
			canEdit:
				!this.#submitting &&
				this.#snapshot.interaction?.phase.kind === "editing",
			canApply:
				!this.#submitting &&
				this.#snapshot.interaction?.phase.kind === "editing" &&
				this.#installed === this.#revision,
			problem: this.#problem,
		};
	}

	change(choices: BarberChoices): void {
		if (
			this.#submitting ||
			this.#snapshot.interaction?.phase.kind !== "editing"
		)
			return;
		this.#choices = choices;
		this.#revision += 1;
		this.#problem = null;
		// Invalidate an obsolete renderer preparation now, while the next semantic request remains
		// coalesced. Restating the last installed body retains a coherent view without letting A
		// briefly install after the user has already chosen B.
		this.#withdrawPreparation();
		this.#requestPreview();
		this.#notify();
	}

	/** A newly ready gameplay driver needs the current candidate even if an older driver retired. */
	refreshPresentation(): void {
		if (
			this.#closed ||
			this.#snapshot.interaction?.phase.kind !== "editing" ||
			this.#submitting
		)
			return;
		this.#withdrawPreparation();
		this.#revision += 1;
		this.#installed = -1;
		this.#pending = null;
		this.#problem = null;
		this.#requestPreview();
		this.#notify();
	}

	apply(): void {
		const interaction = this.#snapshot.interaction;
		if (!this.read().canApply || interaction === null || this.#choices === null)
			return;
		this.#submitting = true;
		this.#notify();
		void this.#session
			.requestBarber({
				kind: "apply",
				id: interaction.id,
				draft: { revision: this.#revision, choices: this.#choices },
			})
			.catch((error) => {
				if (this.#snapshot.interaction?.id === interaction.id) {
					this.#submitting = false;
					this.#fail(error);
				}
			});
	}

	cancel(): void {
		const interaction = this.#snapshot.interaction;
		if (interaction === null || this.#submitting) return;
		// Withdraw locally before the host responds; tagged late results cannot reinstall the editor.
		this.#accept({ ...this.#snapshot, interaction: null });
		void this.#session
			.requestBarber({ kind: "cancel", id: interaction.id })
			.catch((error) => this.#fail(error));
	}

	async destroy(): Promise<void> {
		this.#closed = true;
		this.#unsubscribe();
		this.#listeners.clear();
		await this.#present(null);
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "barber-updated") this.#accept(event.barber);
		else if (event.type === "current-state") {
			const previousId = this.#snapshot.interaction?.id;
			this.#accept(event.state.barber);
			// Preview events are not retained in recovery snapshots. Supersede any lost request
			// without resetting the user's draft or replaying a one-shot Apply.
			if (this.#snapshot.interaction?.id === previousId)
				this.refreshPresentation();
		} else if (event.type === "barber-preview")
			void this.#receivePreview(event.result);
	}

	#accept(snapshot: BarberSnapshot): void {
		if (this.#closed) return;
		const previous = this.#snapshot.interaction;
		const previousResult = this.#snapshot.result;
		if (previous !== null && snapshot.interaction?.id !== previous.id)
			this.#retiredOpening = Math.max(this.#retiredOpening, previous.id);
		if (
			snapshot.interaction !== null &&
			snapshot.interaction.id <= this.#retiredOpening
		)
			snapshot = { ...snapshot, interaction: null };
		this.#snapshot = snapshot;
		const interaction = snapshot.interaction;
		if (interaction?.id !== previous?.id || interaction === null) {
			this.#choices = null;
			this.#revision = 0;
			this.#installed = -1;
			this.#lastGoodPreview = null;
			this.#pending = null;
			this.#submitting = false;
			this.#problem = null;
			void this.#present(null).catch((error) => this.#fail(error));
		}
		if (interaction?.phase.kind === "editing" && this.#choices === null) {
			this.#choices = interaction.phase.original;
			this.#revision = interaction.phase.revision + 1;
			this.#requestPreview();
		}
		const result = snapshot.result;
		if (
			result !== null &&
			(interaction === null || result.id === interaction.id) &&
			result.outcome.kind !== "submitted"
		) {
			this.#problem = result.outcome.message;
			if (
				interaction === null &&
				JSON.stringify(previousResult) !== JSON.stringify(result)
			)
				this.#report(result.outcome.message);
			this.#submitting = false;
		}
		this.#notify();
	}

	#requestPreview(): void {
		const interaction = this.#snapshot.interaction;
		if (
			this.#closed ||
			this.#pending !== null ||
			interaction?.phase.kind !== "editing" ||
			this.#choices === null
		)
			return;
		const revision = this.#revision;
		this.#pending = revision;
		void this.#session
			.requestBarber({
				kind: "preview",
				id: interaction.id,
				draft: { revision, choices: this.#choices },
			})
			.catch((error) => {
				if (
					this.#snapshot.interaction?.id !== interaction.id ||
					this.#pending !== revision
				)
					return;
				if (this.#revision === revision) this.#fail(error);
				this.#finishPreview(interaction.id, revision);
			});
	}

	async #receivePreview(result: BarberPreview): Promise<void> {
		if (
			this.#closed ||
			result.id !== this.#snapshot.interaction?.id ||
			result.revision !== this.#pending
		)
			return;
		try {
			if (result.revision !== this.#revision) return;
			if (result.outcome.kind === "rejected")
				throw new Error(result.outcome.message);
			await this.#present(result);
			if (
				result.id === this.#snapshot.interaction?.id &&
				result.revision === this.#revision
			) {
				this.#installed = result.revision;
				this.#lastGoodPreview = result;
			}
		} catch (error) {
			if (
				result.id === this.#snapshot.interaction?.id &&
				result.revision === this.#revision
			)
				this.#fail(error);
		} finally {
			this.#finishPreview(result.id, result.revision);
		}
	}

	/** Every preview completion releases the same coalescing slot, including command failure. */
	#finishPreview(id: number, revision: number): void {
		if (id !== this.#snapshot.interaction?.id || this.#pending !== revision)
			return;
		this.#pending = null;
		if (this.#revision !== revision) this.#requestPreview();
		this.#notify();
	}

	/** Semantic edits and recovery both invalidate obsolete renderer work immediately. */
	#withdrawPreparation(): void {
		const id = this.#snapshot.interaction?.id;
		if (this.#pending === null || id === undefined) return;
		void this.#present(this.#lastGoodPreview).catch((error) => {
			if (this.#snapshot.interaction?.id === id) this.#fail(error);
		});
	}

	#fail(error: unknown): void {
		if (this.#closed) return;
		this.#problem = error instanceof Error ? error.message : String(error);
		if (this.#snapshot.interaction === null) this.#report(this.#problem);
		this.#notify();
	}
	#notify(): void {
		for (const listener of this.#listeners) listener();
	}
}
