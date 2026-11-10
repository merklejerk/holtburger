import type { AppraisalRequest } from "./client-appraisal-requests";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

/** Exact local feedback shared by combat chat and toast. */
export const SUMMON_ENDED_MESSAGE = "Your summon is no longer active";

/** The owner consumes shared semantics, never raw wire properties or inspector state. */
type SummonSession = Pick<ClientLifecycleSession, "subscribe"> & {
	readonly state: () => Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"lifecycle" | "playerGuid"
	>;
	readonly appraisals: Pick<ClientLifecycleSession["appraisals"], "request">;
	readonly entities: Pick<ClientLifecycleSession["entities"], "read">;
	readonly mirror: Pick<ClientLifecycleSession["mirror"], "isAwaitingSnapshot">;
};

/** One-shot timing interest remains recorded after completion to avoid per-publication retries. */
interface TimingInterest {
	/** Incarnation which acquired the interest. */
	readonly instanceSequence: number;
	/** Null once this consumer's attempt completed; other appraisal consumers remain independent. */
	request: AppraisalRequest | null;
}

/** Session-scoped summon timing acquisition and local end feedback; rendering samples facts directly. */
export class ClientSummonPresentation {
	readonly #session: SummonSession;
	readonly #notify: (message: string) => void;
	readonly #reportFailure: (error: unknown) => void;
	readonly #interests = new Map<number, TimingInterest>();
	readonly #unsubscribe: () => void;

	constructor(
		session: SummonSession,
		notify: (message: string) => void,
		reportFailure: (error: unknown) => void,
	) {
		this.#session = session;
		this.#notify = notify;
		this.#reportFailure = reportFailure;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
		this.#reconcile();
	}

	destroy(): void {
		this.#unsubscribe();
		this.#clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "resyncing" || event.type === "exit-requested") {
			this.#clear();
			return;
		}
		if (event.type === "summon-ended") {
			const state = this.#session.state();
			if (
				state.lifecycle?.kind === "in-world" &&
				!this.#session.mirror.isAwaitingSnapshot() &&
				event.summon.owner === state.playerGuid
			) {
				this.#notify(SUMMON_ENDED_MESSAGE);
			}
			return;
		}
		if (
			event.type === "entities" ||
			event.type === "current-state" ||
			event.type === "lifecycle"
		)
			this.#reconcile();
	}

	#reconcile(): void {
		const read = this.#session.entities.read();
		if (
			this.#session.state().lifecycle?.kind !== "in-world" ||
			read.kind === "pending" ||
			this.#session.mirror.isAwaitingSnapshot()
		) {
			this.#clear();
			return;
		}
		for (const [guid, interest] of this.#interests) {
			const summon = read.level.entities.get(guid)?.summon;
			if (
				summon === undefined ||
				summon === null ||
				summon.activity !== "active" ||
				summon.instanceSequence !== interest.instanceSequence
			) {
				interest.request?.cancel();
				this.#interests.delete(guid);
			}
		}
		for (const entity of read.level.entities.values()) {
			const summon = entity.summon;
			if (
				summon === null ||
				summon.activity !== "active" ||
				summon.lifetime.kind !== "unobserved" ||
				entity.scenePlacement !== "available" ||
				this.#interests.has(entity.guid)
			)
				continue;
			const interest: TimingInterest = {
				instanceSequence: summon.instanceSequence,
				request: null,
			};
			this.#interests.set(entity.guid, interest);
			const request = this.#session.appraisals.request(entity.guid, () => {
				interest.request = null;
			});
			interest.request = request;
			void request.sent.catch((error: unknown) => {
				if (this.#interests.get(entity.guid) !== interest) return;
				interest.request = null;
				this.#reportFailure(error);
			});
		}
	}

	#clear(): void {
		for (const interest of this.#interests.values()) interest.request?.cancel();
		this.#interests.clear();
	}
}
