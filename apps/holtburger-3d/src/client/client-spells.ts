import type { SpellInspectionResult } from "./client-spell-inspection-contract";
import type {
	SpellComponentReference,
	SpellReference,
	SpellReferences,
} from "../app/spell-references";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type { ClientLifecycleSession } from "./client-lifecycle-session";

/** Character-bound details or an explicit query failure. */
export type SpellInspectionDisplay =
	| SpellInspectionResult["outcome"]
	| { readonly kind: "failed"; readonly detail: string };

/** App-local spell resources; display consumers keep independent artwork leases. */
export interface ClientSpellServices {
	/** Authority snapshots and cold knowledge-change events. */
	readonly session: {
		state(): Pick<ReturnType<ClientLifecycleSession["state"]>, "knownSpells">;
		subscribe: ClientLifecycleSession["subscribe"];
		/** Correlated read-only authority query. */
		querySpellInspection: ClientLifecycleSession["querySpellInspection"];
	};
	/** Each consumer retains its own prepared-artwork leases. */
	readonly icons: UiIconRepository;
	/** Resolve static definitions and keep requested known artwork warm for this character. */
	load(ids: readonly number[]): Promise<readonly SpellReference[]>;
	/** Resolve ordered formula slots and retain known-spell artwork across collapse. */
	components(
		spellId: number,
		ids: readonly number[],
	): Promise<readonly SpellComponentReference[]>;
	/** Observe a spell independently of other inspectors, until released. */
	inspect(
		id: number,
		receive: (value: SpellInspectionDisplay) => void,
	): () => void;
}

/** Retain lazily requested known-spell artwork independently of floating panel lifetime. */
export class ClientSpellState implements ClientSpellServices {
	readonly #owner: UiIconOwner;
	readonly #unsubscribe: () => void;
	/** Spell identities can share an image key; release only after its last known spell leaves. */
	readonly #keys = new Map<number, string>();
	/** Correlation allocation shared by independent consumers. */
	#inspectionSequence = 0;
	/** Per-spell owners preserve shared component keys independently. */
	readonly #componentOwners = new Map<number, UiIconOwner>();
	readonly #inspectors = new Set<() => void>();
	#epoch = 0;
	/** Formula context changes do not retire immutable main spell artwork. */
	#formulaEpoch = 0;
	#contextRevision = -1;
	#disposed = false;

	constructor(
		readonly session: ClientSpellServices["session"],
		private readonly references: SpellReferences,
		readonly icons: UiIconRepository,
	) {
		this.#owner = icons.createOwner("persistent");
		this.#unsubscribe = session.subscribe((event) => {
			if (
				event.type === "spell-inspection-context" &&
				event.context.revision !== this.#contextRevision
			) {
				this.#contextRevision = event.context.revision;
				this.#formulaEpoch++;
				for (const owner of this.#componentOwners.values())
					this.icons.releaseOwner(owner);
				this.#componentOwners.clear();
			}
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

	async components(
		spellId: number,
		ids: readonly number[],
	): Promise<readonly SpellComponentReference[]> {
		if (this.#disposed) throw new Error("Spell state is disposed.");
		const epoch = this.#formulaEpoch;
		const definitions = await this.references.components();
		const references = ids.map(
			(id): SpellComponentReference =>
				definitions.get(id) ?? {
					id,
					name: `Component ${id}`,
					artwork: {
						kind: "failed",
						detail: "Component definition is missing.",
					},
				},
		);
		if (
			this.#disposed ||
			epoch !== this.#formulaEpoch ||
			!this.session.state().knownSpells?.includes(spellId)
		)
			return references;
		const previous = this.#componentOwners.get(spellId);
		const owner = this.icons.createOwner("persistent");
		for (const reference of references) {
			if (reference.artwork.kind === "ready")
				this.icons.retain(owner, reference.artwork.spec);
		}
		this.#componentOwners.set(spellId, owner);
		if (previous !== undefined) this.icons.releaseOwner(previous);
		return references;
	}

	inspect(
		id: number,
		receive: (value: SpellInspectionDisplay) => void,
	): () => void {
		if (this.#disposed) throw new Error("Spell state is disposed.");
		let released = false;
		let sequence = -1;
		let revision = -1;
		const refresh = () => {
			sequence = ++this.#inspectionSequence;
			receive({ kind: "pending" });
			if (this.session.state().knownSpells === null) return;
			const requested = sequence;
			void this.session
				.querySpellInspection({ sequence, spellId: id })
				.catch((error: unknown) => {
					if (!released && sequence === requested)
						receive({
							kind: "failed",
							detail: error instanceof Error ? error.message : String(error),
						});
				});
		};
		const unsubscribe = this.session.subscribe((event) => {
			if (event.type === "spell-inspection-context") {
				if (event.context.revision === revision) return;
				revision = event.context.revision;
				refresh();
			} else if (event.type === "spell-inspection-result") {
				const result = event.result;
				if (
					result.sequence !== sequence ||
					result.spellId !== id ||
					result.context.revision < revision
				)
					return;
				revision = result.context.revision;
				receive(result.outcome);
			} else if (
				event.type === "spells" ||
				event.type === "lifecycle" ||
				event.type === "resyncing" ||
				event.type === "current-state"
			)
				refresh();
		});
		const release = () => {
			if (released) return;
			released = true;
			unsubscribe();
			this.#inspectors.delete(release);
		};
		this.#inspectors.add(release);
		refresh();
		return release;
	}

	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
		for (const release of this.#inspectors) release();
		this.#keys.clear();
		for (const owner of this.#componentOwners.values())
			this.icons.releaseOwner(owner);
		this.#componentOwners.clear();
		this.icons.releaseOwner(this.#owner);
	}

	#reconcile(): void {
		const ids = this.session.state().knownSpells;
		// A reset invalidates in-flight lookups even if the next character knows the same IDs.
		if (ids === null) {
			this.#epoch++;
			this.#formulaEpoch++;
		}
		const known = new Set(ids);
		for (const [id, owner] of this.#componentOwners) {
			if (!known.has(id)) {
				this.icons.releaseOwner(owner);
				this.#componentOwners.delete(id);
			}
		}
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
