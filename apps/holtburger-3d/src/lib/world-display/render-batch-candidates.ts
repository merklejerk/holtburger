import type { Object3D } from "three";

import type { RenderBvhItemKey } from "./prepared-bvh-visibility";

const FALLBACK_REASON_SAMPLE_LIMIT = 8;

export interface RenderBatchCandidateBinding {
	batchId: string;
	object: Object3D;
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason?: string | null;
}

interface RenderBatchCandidateSelectionOptions {
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
	queryFallbackReasons?: readonly string[];
}

export interface RenderBatchCandidateSelection {
	candidateBatchIds: ReadonlySet<string>;
	candidateObjects: readonly Object3D[];
	counters: RenderBatchCandidateCounters;
	fallbackReasonSamples: readonly string[];
}

interface RenderBatchCandidateCounters {
	registeredBatchCount: number;
	keyedBatchCount: number;
	representedItemKeyCount: number;
	visibleItemKeyCount: number;
	candidateBatchCount: number;
	itemKeyMatchedBatchCount: number;
	unboundFallbackBatchCount: number;
	explicitFallbackBatchCount: number;
	queryFallbackBatchCount: number;
	fallbackReasonCount: number;
}

export interface RenderBatchCandidateRegistry {
	readonly size: number;
	clear(): void;
	register(binding: RenderBatchCandidateBinding): void;
	unregister(batchId: string): void;
	getObject(batchId: string): Object3D | null;
	selectCandidates(
		options: RenderBatchCandidateSelectionOptions,
	): RenderBatchCandidateSelection;
}

export function createEmptyRenderBatchCandidateSelection(): RenderBatchCandidateSelection {
	return {
		candidateBatchIds: new Set(),
		candidateObjects: [],
		counters: {
			registeredBatchCount: 0,
			keyedBatchCount: 0,
			representedItemKeyCount: 0,
			visibleItemKeyCount: 0,
			candidateBatchCount: 0,
			itemKeyMatchedBatchCount: 0,
			unboundFallbackBatchCount: 0,
			explicitFallbackBatchCount: 0,
			queryFallbackBatchCount: 0,
			fallbackReasonCount: 0,
		},
		fallbackReasonSamples: [],
	};
}

interface StoredRenderBatchCandidateBinding {
	batchId: string;
	object: Object3D;
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason: string | null;
}

export function createRenderBatchCandidateRegistry(): RenderBatchCandidateRegistry {
	const bindingsByBatchId = new Map<
		string,
		StoredRenderBatchCandidateBinding
	>();

	return {
		get size() {
			return bindingsByBatchId.size;
		},
		clear() {
			bindingsByBatchId.clear();
		},
		register(binding) {
			bindingsByBatchId.set(binding.batchId, {
				batchId: binding.batchId,
				object: binding.object,
				itemKeys: [...new Set(binding.itemKeys)],
				fallbackReason: binding.fallbackReason ?? null,
			});
		},
		unregister(batchId) {
			bindingsByBatchId.delete(batchId);
		},
		getObject(batchId) {
			return bindingsByBatchId.get(batchId)?.object ?? null;
		},
		selectCandidates(options) {
			return selectRenderBatchCandidates(bindingsByBatchId.values(), options);
		},
	};
}

function selectRenderBatchCandidates(
	bindings: Iterable<StoredRenderBatchCandidateBinding>,
	options: RenderBatchCandidateSelectionOptions,
): RenderBatchCandidateSelection {
	const queryFallbackReasons = options.queryFallbackReasons ?? [];
	const hasQueryFallback = queryFallbackReasons.length > 0;
	const candidateBatchIds = new Set<string>();
	const candidateObjects: Object3D[] = [];
	const representedItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	const counters: RenderBatchCandidateCounters = {
		registeredBatchCount: 0,
		keyedBatchCount: 0,
		representedItemKeyCount: 0,
		visibleItemKeyCount: options.visibleItemKeys.size,
		candidateBatchCount: 0,
		itemKeyMatchedBatchCount: 0,
		unboundFallbackBatchCount: 0,
		explicitFallbackBatchCount: 0,
		queryFallbackBatchCount: 0,
		fallbackReasonCount: 0,
	};

	for (const binding of bindings) {
		counters.registeredBatchCount += 1;
		for (const itemKey of binding.itemKeys) {
			representedItemKeys.add(itemKey);
		}
		if (binding.itemKeys.length > 0) {
			counters.keyedBatchCount += 1;
		}

		const fallbackReason = resolveBatchFallbackReason(
			binding,
			hasQueryFallback,
		);
		const itemKeyMatched =
			fallbackReason === null &&
			binding.itemKeys.some((itemKey) => options.visibleItemKeys.has(itemKey));
		if (fallbackReason === null && !itemKeyMatched) {
			continue;
		}

		candidateBatchIds.add(binding.batchId);
		candidateObjects.push(binding.object);
		if (itemKeyMatched) {
			counters.itemKeyMatchedBatchCount += 1;
			continue;
		}
		if (fallbackReason === null) {
			throw new Error(
				`Candidate batch ${binding.batchId} had neither a visible item key nor a fallback reason.`,
			);
		}

		fallbackReasons.push(fallbackReason);
		if (binding.itemKeys.length === 0) {
			counters.unboundFallbackBatchCount += 1;
		} else if (binding.fallbackReason) {
			counters.explicitFallbackBatchCount += 1;
		} else {
			counters.queryFallbackBatchCount += 1;
		}
	}

	counters.representedItemKeyCount = representedItemKeys.size;
	counters.candidateBatchCount = candidateBatchIds.size;
	counters.fallbackReasonCount = fallbackReasons.length;
	return {
		candidateBatchIds,
		candidateObjects,
		counters,
		fallbackReasonSamples: [...new Set(fallbackReasons)].slice(
			0,
			FALLBACK_REASON_SAMPLE_LIMIT,
		),
	};
}

function resolveBatchFallbackReason(
	binding: StoredRenderBatchCandidateBinding,
	hasQueryFallback: boolean,
): string | null {
	if (binding.itemKeys.length === 0) {
		return (
			binding.fallbackReason ?? `batch ${binding.batchId} has no BVH item keys`
		);
	}
	if (binding.fallbackReason) {
		return binding.fallbackReason;
	}
	if (hasQueryFallback) {
		return `batch ${binding.batchId} included because BVH query reported fallback data`;
	}
	return null;
}
