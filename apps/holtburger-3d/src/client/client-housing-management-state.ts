import type {
	LocalConfirmationRequest,
	LocalDialogSource,
} from "./client-dialogs";
import type {
	HousingSnapshot,
	HousingManagementRequest,
	HousingManagementResult,
} from "./client-housing-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

type Action = HousingManagementRequest["action"];
type Identity = Pick<HousingManagementRequest, "sequence" | "generation">;
/** Stable checkbox identity; guest commands are case-insensitive. */
type CheckboxKey =
	"publicEntry" | "allegianceEntry" | "allegianceStorage" | `guest:${string}`;
/** Local checkbox intent has request identity and survives component lifetime. */
interface CheckboxIntent {
	readonly sequence: number;
	readonly value: boolean;
	refreshingSeen: boolean;
}
/** A guest row contains presentation state, separate from the retained permission record. */
interface GuestView {
	readonly character: number;
	readonly name: string;
	readonly storageChecked: boolean;
}

/** Narrow session seam keeps confirmation policy local while core owns facts and execution. */
export type HousingManagementSession = Pick<
	ClientLifecycleSession,
	| "housingSnapshot"
	| "queryHousingAccess"
	| "submitHousingManagement"
	| "subscribe"
> & {
	readonly state: () => Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"playerGuid" | "lifecycle"
	>;
};

/** Consumer-paced display facts; no component lifetime owns submitted administration. */
export interface HousingManagementView {
	/** Current named permission facts, nullable until core initialization or refresh replies. */
	readonly records: HousingSnapshot["access"]["records"];
	/** Defaulted/requested checkbox values belong only to H3D presentation. */
	readonly publicEntry: boolean;
	readonly allegianceEntry: boolean;
	readonly allegianceStorage: boolean;
	/** Null retains the distinction between missing records and an empty guest list. */
	readonly guests: readonly GuestView[] | null;
	/** Waiting for home readiness or named records. */
	readonly loading: boolean;
	/** Local dispatch and core payment/management admission disable competing controls. */
	readonly pending: boolean;
	/** Character/home readiness is advisory; core rechecks every request. */
	readonly editable: boolean;
	/** A reviewed destructive request, retired on home/character changes. */
	readonly confirmation: {
		readonly request: HousingManagementRequest;
		readonly message: string;
		/** Local dialog identity rejects answers from dismissed or replaced questions. */
		readonly requestId: string;
	} | null;
}

let nextSequence = 0;
function sequence(): number {
	if (nextSequence === 0xffff_ffff)
		throw new Error("Housing management sequence exhausted");
	return ++nextSequence;
}

/** Local review and receipt ownership survive tab unmounts without inventing server capabilities. */
export class ClientHousingManagementState implements LocalDialogSource {
	readonly #session: HousingManagementSession;
	readonly #failure: (message: string) => void;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<() => void>();
	#confirmation: HousingManagementView["confirmation"] = null;
	#submitted: Identity | null;
	#dispatching = false;
	#disposed = false;
	readonly #intentions = new Map<CheckboxKey, CheckboxIntent>();
	#generation: number;
	#player: number | null;

	constructor(
		session: HousingManagementSession,
		failure: (message: string) => void,
	) {
		this.#session = session;
		this.#generation = session.housingSnapshot().access.generation;
		this.#player = session.state().playerGuid;
		this.#failure = failure;
		this.#submitted = session.housingSnapshot().pendingManagement;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	read(): HousingManagementView {
		const housing = this.#session.housingSnapshot();
		this.#syncIdentity(housing);
		const records = housing.access.records;
		const guests =
			records === null
				? null
				: records.guests.map((guest) => ({
						character: guest.character,
						name: guest.name,
						storageChecked: this.#checked(
							`guest:${guest.name.toLowerCase()}`,
							guest.storageAllowed,
						),
					}));
		const pending =
			this.#dispatching ||
			this.#submitted !== null ||
			housing.pendingManagement !== null ||
			housing.pendingPayment !== null;
		return {
			records,
			publicEntry: this.#checked(
				"publicEntry",
				records === null ? null : records.publicEntry,
			),
			allegianceEntry: this.#checked(
				"allegianceEntry",
				records?.allegiance?.entryAllowed ?? null,
			),
			allegianceStorage: this.#checked(
				"allegianceStorage",
				records?.allegiance?.storageAllowed ?? null,
			),
			guests,
			loading: housing.access.refreshing,
			pending,
			editable:
				!this.#disposed &&
				!pending &&
				!housing.refreshing &&
				!(housing.access.refreshing && housing.access.records === null) &&
				housing.home.kind === "owned" &&
				this.#session.state().lifecycle?.kind === "in-world",
			confirmation: this.#confirmation,
		};
	}

	/** Abandonment alone requires a typed local confirmation. */
	question(): LocalConfirmationRequest | null {
		const local = this.read().confirmation;
		return local === null
			? null
			: {
					requestId: local.requestId,
					text: local.message,
					typedConfirmation: { requiredText: "abandon" },
				};
	}

	/** Publish only local question changes to the shared dialog owner. */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** A modal answer can resolve only the question that supplied its buttons. */
	respond(requestId: string, accepted: boolean): void {
		if (this.#confirmation?.requestId !== requestId) return;
		if (accepted) this.confirm();
		else this.cancel();
	}

	#publish(): void {
		for (const listener of this.#listeners) listener();
	}

	async refresh(): Promise<void> {
		if (this.#disposed || this.read().pending || this.read().loading) return;
		try {
			await this.#session.queryHousingAccess();
		} catch (error) {
			this.#failure(String(error));
		}
	}

	request(action: Action): void {
		const housing = this.#session.housingSnapshot();
		const player = this.#session.state().playerGuid;
		if (!this.read().editable || player === null || this.#confirmation !== null)
			return;
		const request = {
			sequence: sequence(),
			player,
			generation: housing.access.generation,
			action: { ...action },
		};
		if (action.kind === "abandon") {
			this.#confirmation = {
				request,
				requestId: `housing-abandon-${request.sequence}`,
				message: "Abandon this home and remove its deed?",
			};
			this.#publish();
		} else void this.#submit(request);
	}

	confirm(): void {
		const confirmation = this.#confirmation;
		if (confirmation === null || !this.read().editable) return;
		this.#confirmation = null;
		this.#publish();
		if (
			confirmation.request.generation !==
				this.#session.housingSnapshot().access.generation ||
			confirmation.request.player !== this.#session.state().playerGuid
		)
			return;
		void this.#submit(confirmation.request);
	}

	cancel(): void {
		this.#confirmation = null;
		this.#publish();
	}

	async #submit(request: HousingManagementRequest): Promise<void> {
		this.#submitted = request;
		this.#retainIntention(request);
		this.#dispatching = true;
		try {
			await this.#session.submitHousingManagement(request);
		} catch (error) {
			if (!this.#disposed && this.#submitted?.sequence === request.sequence) {
				this.#submitted = null;
				this.#discardIntention(request.sequence);
				this.#failure(String(error));
			}
		} finally {
			this.#dispatching = false;
			this.#settleIntentions(this.#session.housingSnapshot());
		}
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		const previous = this.#confirmation;
		if (event.type === "housing-updated") {
			this.#syncIdentity(event.housing);
			this.#settleIntentions(event.housing);
			if (
				this.#confirmation !== null &&
				(event.housing.access.generation !==
					this.#confirmation.request.generation ||
					event.housing.home.kind !== "owned")
			)
				this.#confirmation = null;
			if (event.housing.pendingManagement !== null)
				this.#submitted = event.housing.pendingManagement;
		} else if (event.type === "current-state") {
			this.#confirmation = null;
			this.#submitted = event.state.housing.pendingManagement;
			this.#syncIdentity(event.state.housing);
			this.#settleIntentions(event.state.housing);
		} else if (event.type === "housing-management-finished") {
			this.#finish(event.result);
		} else if (event.type === "resyncing") {
			this.#confirmation = null;
		} else if (
			event.type === "lifecycle" &&
			event.lifecycle.kind !== "in-world"
		) {
			this.#confirmation = null;
			if (event.lifecycle.kind !== "portal-space") {
				this.#submitted = null;
				this.#intentions.clear();
			}
		}
		if (previous !== this.#confirmation) this.#publish();
	}

	#finish(result: HousingManagementResult): void {
		const submitted = this.#submitted;
		if (
			submitted === null ||
			submitted.sequence !== result.sequence ||
			submitted.generation !== result.generation
		)
			return;
		this.#submitted = null;
		if (
			result.outcome.kind === "rejected" ||
			result.outcome.kind === "unresolved"
		)
			this.#discardIntention(result.sequence);
	}

	#checked(key: CheckboxKey, authoritative: boolean | null): boolean {
		const intention = this.#intentions.get(key);
		return intention === undefined ? authoritative === true : intention.value;
	}

	#syncIdentity(housing: HousingSnapshot): void {
		const player = this.#session.state().playerGuid;
		if (
			this.#generation !== housing.access.generation ||
			this.#player !== player ||
			housing.home.kind !== "owned"
		) {
			this.#intentions.clear();
			this.#generation = housing.access.generation;
			this.#player = player;
		}
	}

	#retainIntention(request: HousingManagementRequest): void {
		const set = (key: CheckboxKey, value: boolean) =>
			this.#intentions.set(key, {
				sequence: request.sequence,
				value,
				refreshingSeen: this.#session.housingSnapshot().access.refreshing,
			});
		const action = request.action;
		switch (action.kind) {
			case "publicEntry":
				set(action.kind, action.enabled);
				break;
			case "allegianceEntry":
				set(action.kind, action.enabled);
				if (!action.enabled) set("allegianceStorage", false);
				break;
			case "allegianceStorage":
				set(action.kind, action.enabled);
				if (action.enabled) set("allegianceEntry", true);
				break;
			case "storage":
				set(`guest:${action.name.toLowerCase()}`, action.allowed);
				break;
			case "addAllStorage":
			case "removeAllStorage": {
				const records = this.#session.housingSnapshot().access.records;
				if (records !== null)
					for (const guest of records.guests)
						set(
							`guest:${guest.name.toLowerCase()}`,
							action.kind === "addAllStorage",
						);
				break;
			}
		}
	}

	#settleIntentions(housing: HousingSnapshot): void {
		for (const [key, intention] of this.#intentions) {
			if (housing.access.refreshing) intention.refreshingSeen = true;
			else if (
				!this.#dispatching &&
				intention.refreshingSeen &&
				housing.access.records !== null &&
				(!key.startsWith("allegiance") ||
					housing.access.records.allegiance !== null)
			)
				this.#intentions.delete(key);
		}
	}

	#discardIntention(sequence: number): void {
		for (const [key, intention] of this.#intentions)
			if (intention.sequence === sequence) this.#intentions.delete(key);
	}

	destroy(): void {
		this.#disposed = true;
		this.#confirmation = null;
		this.#unsubscribe();
		this.#publish();
		this.#listeners.clear();
	}
}
