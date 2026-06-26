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

	retainSourceScopeKeys(retainedScopeKeys: ReadonlySet<string>): void {
		for (const [id, record] of this.#recordsById) {
			if (!retainedScopeKeys.has(record.provenance.sourceScopeKey)) {
				this.#recordsById.delete(id);
			}
		}
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
