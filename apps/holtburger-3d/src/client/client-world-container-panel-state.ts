import type { ItemCapacity } from "../app/item-capacity";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import {
	contentsMembership,
	contentsSections,
	contentsPackSlots,
	nextContentsSortMode,
	type ClientContentsSection,
	type ContentsSortMode,
} from "./client-container-contents";
import { retainContentsVisuals } from "./client-contents-visuals";
import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";
import type { ClientLifecycle } from "./client-host-contract";
import type { ClientLifecycleSession } from "./client-lifecycle-session";

/** Minimal session facts and commands consumed by external-storage presentation. */
interface WorldContainerSession extends Pick<
	ClientLifecycleSession,
	"submitInventory" | "closeContainer"
> {
	readonly entities: { read(): ClientEntityRead };
	state(): { readonly lifecycle: ClientLifecycle | null };
}

/** One sampled presentation; shared access and entity records remain session-owned. */
export interface ClientWorldContainerView {
	/** Confirmed external storage identity and its latest description. */
	readonly root: ClientEntityFacts;
	/** Recovery retains the last picture with actions disabled. */
	readonly pending: boolean;
	/** App-local section ordering, independent from player inventory. */
	readonly sortMode: ContentsSortMode;
	/** Combined root and direct-child-pack contents. */
	readonly sections: readonly ClientContentsSection[];
	/** Native-order navigable root/pack identities, excluding foci. */
	readonly packs: readonly ClientEntityFacts[];
	/** Shared capacity bars keyed by storage identity. */
	readonly capacities: ReadonlyMap<number, ItemCapacity>;
	/** Icon leases consumed by the mounted display sampler. */
	readonly iconKeys: ReadonlyMap<number, string>;
}

/** Session-local external storage presentation, separate from player inventory preferences. */
export class ClientWorldContainerPanelState {
	readonly #owner: UiIconOwner;
	readonly #session: WorldContainerSession;
	readonly icons: UiIconRepository;
	readonly reportFailure: (message: string) => void;
	#revision = -1;
	#view: ClientWorldContainerView | null = null;
	#sortMode: ContentsSortMode = "native";
	#keys: ReadonlySet<string> = new Set();
	#closing: { readonly root: number } | null = null;
	constructor(
		session: WorldContainerSession,
		icons: UiIconRepository,
		reportFailure: (message: string) => void,
	) {
		this.#owner = icons.createOwner("persistent");
		this.#session = session;
		this.icons = icons;
		this.reportFailure = reportFailure;
	}

	/** Called at the mounted display cadence, never from producer callbacks. */
	read(): ClientWorldContainerView | null {
		const read = this.#session.entities.read();
		if (this.#session.state().lifecycle?.kind !== "in-world") {
			this.#clear();
			return null;
		}
		if (read.kind === "pending") {
			if (this.#view !== null && !this.#view.pending)
				this.#view = { ...this.#view, pending: true };
			return this.#view;
		}
		const { level } = read;
		if (level.worldContainer.kind === "closed") {
			this.#clear();
			return null;
		}
		if (this.#revision === level.revision && !this.#view?.pending)
			return this.#view;
		const root = level.entities.get(level.worldContainer.root);
		if (root === undefined)
			throw new Error("Confirmed container is missing its root identity.");
		if (this.#view?.root.guid !== root.guid) this.#closing = null;
		const membership = contentsMembership(
			root,
			[...level.entities.values()].filter(
				(entity) => entity.worldContainerContent,
			),
		);
		const visuals = retainContentsVisuals(
			membership.members,
			membership,
			null,
			this.icons,
			this.#owner,
		);
		for (const key of this.#keys)
			if (!visuals.retainedKeys.has(key)) this.icons.release(this.#owner, key);
		this.#keys = visuals.retainedKeys;
		this.#revision = level.revision;
		this.#view = {
			root,
			pending: false,
			sortMode: this.#sortMode,
			sections: contentsSections(membership, "containers", this.#sortMode),
			packs: contentsPackSlots(membership).filter(
				(item): item is ClientEntityFacts =>
					item !== null &&
					(item.guid === root.guid ||
						(item.location.kind === "contained" &&
							item.location.slot.kind === "pack" &&
							item.location.slot.entryKind === "container")),
			),
			capacities: visuals.capacities,
			iconKeys: visuals.iconKeys,
		};
		return this.#view;
	}

	cycleSort(): void {
		this.#sortMode = nextContentsSortMode(this.#sortMode);
		this.#revision = -1;
	}

	/** A stale rendered cell cannot acquire a transferred or revoked identity. */
	pickup(guid: number): void {
		const read = this.#session.entities.read();
		const item =
			read.kind === "current" ? read.level.entities.get(guid) : undefined;
		if (
			this.#session.state().lifecycle?.kind !== "in-world" ||
			item === undefined ||
			!item.worldContainerContent ||
			!item.canPickUp
		) {
			this.reportFailure("This item cannot currently be picked up.");
			return;
		}
		void this.#session
			.submitInventory({
				item: guid,
				target: { kind: "pickup", container: null },
			})
			.catch((error: unknown) => this.reportFailure(String(error)));
	}

	/** A repeated click or stale window must not close a replacement container. */
	close(root: number): void {
		const read = this.#session.entities.read();
		if (
			read.kind !== "current" ||
			read.level.worldContainer.kind !== "open" ||
			read.level.worldContainer.root !== root ||
			this.#closing?.root === root
		)
			return;
		const request = { root };
		this.#closing = request;
		void this.#session
			.closeContainer(root)
			.catch((error: unknown) => this.reportFailure(String(error)))
			.finally(() => {
				// Coalesce in-flight clicks, not a sampled root's whole lifetime. A close and
				// same-root reopen can both arrive between two display samples.
				if (this.#closing === request) this.#closing = null;
			});
	}

	destroy(): void {
		this.#clear();
		this.icons.releaseOwner(this.#owner);
	}

	#clear(): void {
		this.#revision = -1;
		this.#view = null;
		this.#closing = null;
		for (const key of this.#keys) this.icons.release(this.#owner, key);
		this.#keys = new Set();
	}
}
