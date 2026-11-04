import { matchesSearchTerms, textSearchWords } from "../app/text-search";
import type {
	LocalConfirmationRequest,
	LocalDialogSource,
} from "./client-dialogs";
import type {
	ContractRow,
	ContractsAction,
	ContractsSnapshot,
} from "./client-contracts-contract";

/** Status categories are presentation policy; unresolved content has its own filter. */
export type ContractFilter =
	"available" | "inProgress" | "completed" | "waitingToRepeat" | "unresolved";

/** Browser-local aging of owner-resolved timer roles; no wire-stage interpretation. */
function ageContractRow(row: ContractRow, elapsed: number): ContractRow {
	if (row.kind === "unresolved") return row;
	const repeat =
		row.status.kind === "waitingToRepeat"
			? row.status.remainingSeconds - elapsed
			: null;
	const deadline =
		row.deadline?.kind === "running"
			? row.deadline.remainingSeconds - elapsed
			: null;
	return {
		...row,
		status:
			repeat === null
				? row.status
				: repeat > 0
					? { kind: "waitingToRepeat", remainingSeconds: repeat }
					: { kind: "available" },
		deadline:
			deadline === null
				? row.deadline
				: deadline > 0
					? { kind: "running", remainingSeconds: deadline }
					: { kind: "finished" },
	};
}

/** Names can collide; identity and expansion always use the server contract ID. */
export function contractName(row: ContractRow): string {
	return row.kind === "resolved" ? row.name : `Contract #${row.id}`;
}

/** One local question, distinct from a queued mutation or server acknowledgement. */
interface RemoveQuestion {
	/** Identity rechecked against authoritative membership on acceptance. */
	readonly id: number;
	/** Local dialog identity; unrelated to server acknowledgements. */
	readonly request: LocalConfirmationRequest;
	/** Existing notice path for a failed dispatch. */
	readonly onFailure: (message: string) => void;
}

/** Session-lifetime read model and cold journal controls; world owns membership. */
export class ClientContractsState implements LocalDialogSource {
	readonly #submit: (action: ContractsAction) => Promise<void>;
	readonly #now: () => number;
	readonly #listeners = new Set<() => void>();
	/** Map consumers observe accepted facts, independently of local Journal/dialog controls. */
	readonly #factsListeners = new Set<() => void>();
	#snapshot: {
		readonly facts: ContractsSnapshot;
		readonly receivedAtMs: number;
	} | null = null;
	#player: number | null = null;
	#enabled = false;
	#search = "";
	/** Selected statuses form a union; an empty selection includes every status. */
	#filters: readonly ContractFilter[] = [];
	#expanded = new Set<number>();
	#question: RemoveQuestion | null = null;
	#questionSequence = 0;

	constructor(
		submit: (action: ContractsAction) => Promise<void>,
		now: () => number,
	) {
		this.#submit = submit;
		this.#now = now;
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	/** Fact-only notifications keep query changes off the map's preparation path. */
	subscribeFacts(listener: () => void): () => void {
		this.#factsListeners.add(listener);
		return () => this.#factsListeners.delete(listener);
	}
	#publishFacts(): void {
		for (const listener of this.#factsListeners) listener();
	}
	#publish(): void {
		for (const listener of this.#listeners) listener();
	}

	/** Local player establishment follows early tracker delivery; it must not erase it. */
	setContext(player: number | null, enabled: boolean): void {
		if (this.#player !== null && player !== this.#player) this.reset();
		this.#player = player;
		this.#enabled = enabled;
		if (!enabled) this.#question = null;
		this.#publish();
	}

	/** Replace facts and age anchor together; panel visibility never resets either. */
	update(snapshot: ContractsSnapshot | null): void {
		this.#snapshot =
			snapshot === null ? null : { facts: snapshot, receivedAtMs: this.#now() };
		const ids = new Set(snapshot?.rows.map((row) => row.id));
		this.#expanded = new Set([...this.#expanded].filter((id) => ids.has(id)));
		if (this.#question !== null && !ids.has(this.#question.id))
			this.#question = null;
		this.#publishFacts();
		this.#publish();
	}

	recover(
		snapshot: ContractsSnapshot | null,
		player: number | null,
		enabled: boolean,
	): void {
		this.setContext(player, enabled);
		this.update(snapshot);
	}

	setSearch(search: string): void {
		this.#search = search;
		this.#publish();
	}
	setFilters(filters: readonly ContractFilter[]): void {
		this.#filters = [...filters];
		this.#publish();
	}
	toggleExpanded(id: number): void {
		if (!this.#snapshot?.facts.rows.some((row) => row.id === id)) return;
		if (this.#expanded.has(id)) this.#expanded.delete(id);
		else this.#expanded.add(id);
		this.#publish();
	}

	/** Age all accepted facts independently of Journal controls or panel visibility. */
	readFacts(): ContractsSnapshot | null {
		const snapshot = this.#snapshot;
		if (snapshot === null) return null;
		const elapsed = Math.max(0, (this.#now() - snapshot.receivedAtMs) / 1000);
		return {
			rows: snapshot.facts.rows.map((row) => ageContractRow(row, elapsed)),
		};
	}

	/** Pull display facts at the panel's bounded cadence, independent of producer rate. */
	read() {
		const facts = this.readFacts();
		const controls = {
			/** Character identity owns the retained list DOM and scroll lifetime. */
			character: this.#player,
			search: this.#search,
			filters: [...this.#filters],
			expanded: new Set(this.#expanded),
			enabled: this.#enabled && this.#player !== null,
		};
		if (facts === null) return { ...controls, journal: null };
		const terms = textSearchWords(this.#search);
		const rows = facts.rows
			.filter(
				(row) =>
					matchesSearchTerms(
						textSearchWords(
							row.kind === "resolved"
								? `${row.name} ${row.description}`
								: contractName(row),
						),
						terms,
					) &&
					(this.#filters.length === 0 ||
						this.#filters.includes(
							row.kind === "unresolved" ? "unresolved" : row.status.kind,
						)),
			)
			.toSorted(
				(left, right) =>
					contractName(left).localeCompare(contractName(right)) ||
					left.id - right.id,
			);
		return {
			...controls,
			journal: { rows, total: facts.rows.length },
		};
	}

	requestRemove(id: number, onFailure: (message: string) => void): void {
		const row = this.#snapshot?.facts.rows.find((row) => row.id === id);
		if (row === undefined || !this.#enabled || this.#player === null) return;
		this.#question = {
			id,
			onFailure,
			request: {
				requestId: `contract-remove-${++this.#questionSequence}`,
				text: `Remove ${contractName(row)} from your journal? Quest progress is retained.`,
			},
		};
		this.#publish();
	}
	question(): LocalConfirmationRequest | null {
		return this.#question?.request ?? null;
	}
	respond(requestId: string, accepted: boolean): void {
		const question = this.#question;
		if (question === null || question.request.requestId !== requestId) return;
		this.#question = null;
		this.#publish();
		if (
			!accepted ||
			!this.#enabled ||
			this.#player === null ||
			!this.#snapshot?.facts.rows.some((row) => row.id === question.id)
		)
			return;
		const player = this.#player;
		void this.#submit({ kind: "remove", id: question.id }).catch(
			(error: unknown) => {
				console.error("Contract removal failed", error);
				if (this.#player === player)
					question.onFailure("Couldn’t remove contract from journal.");
			},
		);
	}
	/** Hiding the retained window dismisses transient confirmation only. */
	dismissQuestion(): void {
		if (this.#question === null) return;
		this.#question = null;
		this.#publish();
	}
	reset(): void {
		this.#snapshot = null;
		this.#player = null;
		this.#enabled = false;
		this.#search = "";
		this.#filters = [];
		this.#expanded.clear();
		this.#question = null;
		this.#publishFacts();
		this.#publish();
	}
}
