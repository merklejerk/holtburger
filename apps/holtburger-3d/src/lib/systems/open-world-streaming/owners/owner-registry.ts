import type {
	MaterializationOwner,
	MaterializationOwnerId,
	MaterializationOwnerKind,
} from "./owner-id";

export type MaterializationOwnerToken = string & {
	readonly __brand: "MaterializationOwnerToken";
};

export interface MaterializationOwnerSnapshot {
	readonly current: readonly MaterializationOwnerSnapshotEntry[];
	readonly evictedCount: number;
}

interface MaterializationOwnerSnapshotEntry {
	readonly id: MaterializationOwnerId;
	readonly kind: MaterializationOwnerKind;
	readonly token: MaterializationOwnerToken;
}

interface MaterializationOwnerState {
	readonly owner: MaterializationOwner;
	readonly token: MaterializationOwnerToken;
}

export class MaterializationOwnerRegistry {
	readonly #owners = new Map<
		MaterializationOwnerId,
		MaterializationOwnerState
	>();
	#evictedCount = 0;
	#tokenSequence = 0;

	retain(owner: MaterializationOwner): MaterializationOwnerToken {
		const existing = this.#owners.get(owner.id);
		if (existing) {
			return existing.token;
		}

		const token = this.#createToken(owner.id);
		this.#owners.set(owner.id, { owner, token });
		return token;
	}

	evict(ownerId: MaterializationOwnerId): boolean {
		const deleted = this.#owners.delete(ownerId);
		if (deleted) {
			this.#evictedCount += 1;
		}
		return deleted;
	}

	replace(owner: MaterializationOwner): MaterializationOwnerToken {
		if (this.#owners.delete(owner.id)) {
			this.#evictedCount += 1;
		}
		const token = this.#createToken(owner.id);
		this.#owners.set(owner.id, { owner, token });
		return token;
	}

	has(ownerId: MaterializationOwnerId): boolean {
		return this.#owners.has(ownerId);
	}

	isCurrent(input: {
		readonly ownerId: MaterializationOwnerId;
		readonly token: MaterializationOwnerToken;
	}): boolean {
		return this.#owners.get(input.ownerId)?.token === input.token;
	}

	requireCurrent(input: {
		readonly ownerId: MaterializationOwnerId;
		readonly token: MaterializationOwnerToken;
		readonly subject: string;
	}): void {
		if (!this.isCurrent(input)) {
			throw new Error(`${input.subject} is stale for owner ${input.ownerId}.`);
		}
	}

	createSnapshot(): MaterializationOwnerSnapshot {
		return {
			current: [...this.#owners.values()]
				.map((state) => ({
					id: state.owner.id,
					kind: state.owner.kind,
					token: state.token,
				}))
				.sort((left, right) => left.id.localeCompare(right.id)),
			evictedCount: this.#evictedCount,
		};
	}

	#createToken(ownerId: MaterializationOwnerId): MaterializationOwnerToken {
		const sequence = this.#tokenSequence;
		this.#tokenSequence += 1;
		return `${ownerId}#${sequence}` as MaterializationOwnerToken;
	}
}
