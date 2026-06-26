import type {
	DynamicEntityId,
	DynamicEntityRecord,
	DynamicRuntimeSnapshot,
} from "./contracts";

export class DynamicEntityStore {
	readonly #recordsById = new Map<DynamicEntityId, DynamicEntityRecord>();

	upsert(record: DynamicEntityRecord): void {
		this.#recordsById.set(record.id, record);
	}

	update(
		id: DynamicEntityId,
		updateRecord: (record: DynamicEntityRecord) => DynamicEntityRecord,
	): DynamicEntityRecord | null {
		const record = this.#recordsById.get(id);
		if (!record) {
			return null;
		}

		const updated = updateRecord(record);
		this.#recordsById.set(id, updated);
		return updated;
	}

	retainSourceScopeKeys(
		retainedScopeKeys: ReadonlySet<string>,
	): readonly DynamicEntityRecord[] {
		const removed: DynamicEntityRecord[] = [];
		for (const [id, record] of this.#recordsById) {
			if (!retainedScopeKeys.has(record.provenance.sourceScopeKey)) {
				removed.push(record);
				this.#recordsById.delete(id);
			}
		}
		return removed;
	}

	get(id: DynamicEntityId): DynamicEntityRecord | null {
		return this.#recordsById.get(id) ?? null;
	}

	records(): readonly DynamicEntityRecord[] {
		return [...this.#recordsById.values()].sort(compareDynamicEntityRecords);
	}

	createSnapshot(): DynamicRuntimeSnapshot {
		const records = this.records();
		return {
			activeEntityCount: records.length,
			issueCount: records.reduce(
				(count, record) => count + record.diagnostics.length,
				0,
			),
			nonRenderableEntityCount: records.filter(
				(record) => record.renderability.status === "non-renderable",
			).length,
			records,
			staticSeedCount: records.length,
		};
	}
}

function compareDynamicEntityRecords(
	left: DynamicEntityRecord,
	right: DynamicEntityRecord,
): number {
	return left.id.localeCompare(right.id);
}
