import { LeaseRegistry } from "../lib/game/ownership";
import {
	MAX_ICON_BATCH,
	type IconIssue,
	type ItemIconRequest,
	type ItemIconSpec,
	type PreparedItemIcon,
} from "./item-icon-source";

/** Persistent models and temporary displayed snapshots share the same lease accounting. */
export interface ItemIconOwner {
	readonly kind: "persistent" | "display";
}
/** Local preparation failures join host diagnostics without inventing a game property. */
type ItemIconProblem =
	IconIssue | { readonly code: "preparation"; readonly detail: string };
type ItemIconProblems = readonly [ItemIconProblem, ...ItemIconProblem[]];
/** Immutable bounded-cadence UI snapshot; names remain the cell's fallback. */
export type ItemIconDisplay =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly url: string }
	| {
			readonly kind: "degraded";
			readonly url: string;
			readonly issues: ItemIconProblems;
	  }
	| { readonly kind: "failed"; readonly issues: ItemIconProblems };

/** Inject browser capabilities so lifetime tests need no DOM. */
export interface ItemIconServices {
	readonly prepare: (
		requests: readonly ItemIconRequest[],
	) => Promise<readonly PreparedItemIcon[]>;
	/** Validate/decode once; reject after cleaning any URL allocated before failure. */
	readonly createImage: (bytes: Uint8Array) => Promise<string>;
	readonly revokeImage: (url: string) => void;
	readonly report: (
		key: string,
		spec: ItemIconSpec,
		issues: ItemIconProblems,
	) => void;
}
type EntryState =
	| { readonly kind: "queued" }
	| { readonly kind: "preparing" }
	| Exclude<ItemIconDisplay, { kind: "loading" }>;
interface Entry extends ItemIconRequest {
	state: EntryState;
}
const loading: ItemIconDisplay = Object.freeze({ kind: "loading" });

/** Canonical complete-input identity. Retail mask interpretation stays in the host. */
function itemIconKey(spec: ItemIconSpec): string {
	return JSON.stringify([
		spec.kind,
		spec.kind === "item" ? spec.base : null,
		spec.kind === "item" ? spec.itemType : null,
		spec.overlay,
		spec.underlay,
		spec.uiEffects,
	]);
}

/** One content-source lifetime: shared references, bounded work and owned browser URLs. */
export class ItemIconRepository {
	readonly #services: ItemIconServices;
	readonly #leases = new LeaseRegistry<ItemIconOwner>();
	readonly #entries = new Map<string, Entry>();
	#running = false;
	#disposed = false;
	#revision = 0;
	constructor(services: ItemIconServices) {
		this.#services = services;
	}
	get revision(): number {
		return this.#revision;
	}
	createOwner(kind: ItemIconOwner["kind"]): ItemIconOwner {
		if (this.#disposed) throw new Error("Icon repository is disposed.");
		// Object identity prevents collisions between callers, display uses and repositories.
		const owner = Object.freeze({ kind });
		this.#leases.addOwner(owner);
		return owner;
	}
	retain(owner: ItemIconOwner, spec: ItemIconSpec): string {
		this.#requireOwner(owner);
		const key = itemIconKey(spec);
		if (!this.#entries.has(key)) {
			this.#entries.set(key, { key, spec, state: { kind: "queued" } });
			this.#revision++;
		}
		this.#leases.addLease(owner, key);
		this.#schedule();
		return key;
	}
	/** Protect a published image until its consumer commits a replacement. */
	retainKey(owner: ItemIconOwner, key: string): void {
		this.#requireOwner(owner);
		if (!this.#entries.has(key))
			throw new Error(`Cannot retain unknown icon: ${key}`);
		this.#leases.addLease(owner, key);
	}
	read(key: string): ItemIconDisplay {
		const entry = this.#entries.get(key);
		if (!entry) throw new Error(`Unknown retained icon: ${key}`);
		return entry.state.kind === "queued" || entry.state.kind === "preparing"
			? loading
			: entry.state;
	}
	release(owner: ItemIconOwner, key: string): void {
		this.#leases.dropLease(owner, key);
		this.#collect();
	}
	releaseOwner(owner: ItemIconOwner): void {
		this.#leases.dropOwner(owner);
		this.#collect();
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		// Display uses release only after DOM replacement/unmount commits.
		for (const owner of [...this.#leases.iterOwners()]) {
			if (owner.kind === "persistent") this.#leases.dropOwner(owner);
		}
		this.#collect();
	}
	#requireOwner(owner: ItemIconOwner): void {
		if (this.#disposed || !this.#leases.hasOwner(owner))
			throw new Error("Icon owner is not active in this repository.");
	}
	#collect(): void {
		for (const key of this.#leases.takeEmptyLeases()) {
			const entry = this.#entries.get(key);
			if (!entry) continue;
			if (entry.state.kind === "ready" || entry.state.kind === "degraded")
				this.#services.revokeImage(entry.state.url);
			this.#entries.delete(key);
			this.#revision++;
		}
	}
	#schedule(): void {
		if (this.#running || this.#disposed) return;
		this.#running = true;
		// Coalesce a synchronous reconciliation before selecting its first batch.
		queueMicrotask(() => {
			void this.#drain();
		});
	}
	async #drain(): Promise<void> {
		try {
			while (!this.#disposed) {
				const batch: Entry[] = [];
				for (const entry of this.#entries.values()) {
					if (entry.state.kind === "queued") batch.push(entry);
					if (batch.length === MAX_ICON_BATCH) break;
				}
				if (batch.length === 0) break;
				for (const entry of batch) entry.state = { kind: "preparing" };
				try {
					const results = await this.#services.prepare(
						batch.map(({ key, spec }) => ({ key, spec })),
					);
					// The source adapter validates completeness/unique keys. Identity checks
					// also reject a same-key entry reacquired while this batch was in flight.
					await Promise.all(
						results.map(async (result) => {
							const entry = this.#entries.get(result.key);
							if (!entry || !batch.includes(entry) || !this.#accepts(entry))
								return;
							await this.#install(entry, result);
						}),
					);
				} catch (error) {
					for (const entry of batch) {
						if (this.#accepts(entry) && entry.state.kind === "preparing")
							this.#fail(entry, error);
					}
				}
			}
		} finally {
			this.#running = false;
		}
	}
	#accepts(entry: Entry): boolean {
		return !this.#disposed && this.#entries.get(entry.key) === entry;
	}
	async #install(entry: Entry, result: PreparedItemIcon): Promise<void> {
		if (result.kind === "failed") {
			this.#settle(entry, { kind: "failed", issues: result.issues });
			return;
		}
		try {
			const url = await this.#services.createImage(result.image);
			if (!this.#accepts(entry)) {
				this.#services.revokeImage(url);
				return;
			}
			this.#settle(
				entry,
				result.kind === "ready"
					? { kind: "ready", url }
					: { kind: "degraded", url, issues: result.issues },
			);
		} catch (error) {
			if (this.#accepts(entry)) this.#fail(entry, error);
		}
	}
	#fail(entry: Entry, error: unknown): void {
		const detail = error instanceof Error ? error.message : String(error);
		this.#settle(entry, {
			kind: "failed",
			issues: [{ code: "preparation", detail }],
		});
	}
	#settle(
		entry: Entry,
		state: Exclude<ItemIconDisplay, { kind: "loading" }>,
	): void {
		entry.state = Object.freeze(state);
		this.#revision++;
		if (state.kind === "failed" || state.kind === "degraded")
			this.#services.report(entry.key, entry.spec, state.issues);
	}
}

/** Production services; failed browser decoding cleans its URL before rejecting. */
export function browserItemIconRepository(
	prepare: ItemIconServices["prepare"],
): ItemIconRepository {
	return new ItemIconRepository({
		prepare,
		async createImage(bytes) {
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(bytes)], { type: "image/png" }),
			);
			try {
				const image = new Image();
				image.src = url;
				await image.decode();
				return url;
			} catch (error) {
				URL.revokeObjectURL(url);
				throw error;
			}
		},
		revokeImage: (url) => URL.revokeObjectURL(url),
		report: (key, spec, issues) =>
			console.warn("Item icon preparation:", key, { spec, issues }),
	});
}
