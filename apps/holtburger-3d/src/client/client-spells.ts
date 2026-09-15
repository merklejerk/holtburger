import type { SpellReference, SpellReferences } from "../app/spell-references";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type { ClientLifecycleSession } from "./client-lifecycle-session";

/** App-local spell resources; display consumers keep independent artwork leases. */
export interface ClientSpellServices {
	/** Authority snapshots and cold knowledge-change events. */
	readonly session: {
		state(): Pick<ReturnType<ClientLifecycleSession["state"]>, "knownSpells">;
		subscribe: ClientLifecycleSession["subscribe"];
	};
	/** Each consumer retains its own prepared-artwork leases. */
	readonly icons: UiIconRepository;
	/** Resolve static definitions and keep requested known artwork warm for this character. */
	load(ids: readonly number[]): Promise<readonly SpellReference[]>;
}

/** Retain lazily requested known-spell artwork independently of floating panel lifetime. */
export class ClientSpellState implements ClientSpellServices {
	readonly #owner: UiIconOwner;
	readonly #unsubscribe: () => void;
	/** Spell identities can share an image key; release only after its last known spell leaves. */
	readonly #keys = new Map<number, string>();
	#epoch = 0;
	#disposed = false;

	constructor(
		readonly session: ClientSpellServices["session"],
		private readonly references: SpellReferences,
		readonly icons: UiIconRepository,
	) {
		this.#owner = icons.createOwner("persistent");
		this.#unsubscribe = session.subscribe((event) => {
			if (
				event.type === "spells" ||
				event.type === "current-state" ||
				event.type === "lifecycle" ||
				event.type === "resyncing"
			)
				this.#reconcile();
		});
	}

	async load(ids: readonly number[]): Promise<readonly SpellReference[]> {
		if (this.#disposed) throw new Error("Spell state is disposed.");
		const epoch = this.#epoch;
		const references = await this.references.load(ids);
		if (this.#disposed || epoch !== this.#epoch) return references;
		const known = new Set(this.session.state().knownSpells);
		for (const reference of references) {
			if (
				known.has(reference.id) &&
				reference.kind === "known" &&
				reference.artwork.kind === "ready"
			)
				this.#keys.set(
					reference.id,
					this.icons.retain(this.#owner, reference.artwork.spec),
				);
		}
		return references;
	}

	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
		this.#keys.clear();
		this.icons.releaseOwner(this.#owner);
	}

	#reconcile(): void {
		const ids = this.session.state().knownSpells;
		// A reset invalidates in-flight lookups even if the next character knows the same IDs.
		if (ids === null) this.#epoch++;
		const known = new Set(ids);
		const previous = new Set(this.#keys.values());
		for (const id of this.#keys.keys()) {
			if (!known.has(id)) this.#keys.delete(id);
		}
		const retained = new Set(this.#keys.values());
		for (const key of previous) {
			if (!retained.has(key)) this.icons.release(this.#owner, key);
		}
	}
}
