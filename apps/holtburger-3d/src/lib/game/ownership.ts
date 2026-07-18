/** Shared owner-to-resource lease accounting for runtime-managed resources. */
export class LeaseRegistry<
	TOwnerId extends string = string,
	TLeaseId extends string = string,
> {
	readonly #leaseCounts: Map<TLeaseId, number> = new Map();
	readonly #owners: Map<TOwnerId, Set<TLeaseId>> = new Map();

	addOwner(owner: TOwnerId) {
		this.#ensureOwner(owner);
	}

	#ensureOwner(owner: TOwnerId): Set<TLeaseId> {
		let v = this.#owners.get(owner);
		if (!v) {
			v = new Set();
			this.#owners.set(owner, v);
		}
		return v;
	}

	hasOwner(owner: TOwnerId): boolean {
		return this.#owners.has(owner);
	}

	/** Check whether at least one owner still retains a lease. */
	hasLease(lease: TLeaseId): boolean {
		return (this.#leaseCounts.get(lease) ?? 0) > 0;
	}

	addLease(owner: TOwnerId, lease: TLeaseId): boolean {
		const leases = this.#ensureOwner(owner);
		if (leases.has(lease)) {
			return false;
		}
		leases.add(lease);
		this.#increaseLeaseCount(lease, 1);
		return true;
	}

	dropLease(owner: TOwnerId, lease: TLeaseId): boolean {
		const leases = this.#owners.get(owner);
		if (!leases) {
			return false;
		}
		if (leases.delete(lease)) {
			this.#increaseLeaseCount(lease, -1);
			return true;
		}
		return false;
	}

	#increaseLeaseCount(lease: TLeaseId, amt: number): number {
		if (!this.#leaseCounts.has(lease)) {
			this.#leaseCounts.set(lease, 0);
		}
		const c = Math.max(0, (this.#leaseCounts.get(lease) ?? 0) + amt);
		this.#leaseCounts.set(lease, c);
		return c;
	}

	takeEmptyLeases(): Set<TLeaseId> {
		const empties = new Set<TLeaseId>();
		for (const [ref, count] of this.#leaseCounts.entries()) {
			if (count <= 0) {
				empties.add(ref);
			}
		}
		for (const ref of empties) {
			this.#leaseCounts.delete(ref);
		}
		return empties;
	}

	dropOwner(owner: TOwnerId): boolean {
		const leases = this.#owners.get(owner);
		if (!leases) {
			return false;
		}
		for (const ref of leases) {
			this.#increaseLeaseCount(ref, -1);
		}
		leases.clear();
		this.#owners.delete(owner);
		return true;
	}

	*iterOwnerLeases(owner: TOwnerId): Generator<TLeaseId> {
		const leases = this.#owners.get(owner);
		if (!leases) {
			return;
		}
		for (const lease of leases) {
			yield lease;
		}
	}

	*iterOwners(): Generator<TOwnerId> {
		for (const id of this.#owners.keys()) {
			yield id;
		}
	}
}
