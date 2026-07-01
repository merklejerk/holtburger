export interface StaticMaterialBatchCandidate {
	readonly batchKey: string;
	readonly materialEntryKey: string;
}

export interface StaticMaterialBatchSlice<
	TCandidate extends StaticMaterialBatchCandidate,
> {
	readonly batchKey: string;
	readonly batchIndex: number;
	readonly sliceIndex: number;
	readonly sliceId: string;
	readonly candidates: readonly TCandidate[];
}

export interface StaticMaterialBatchSliceGuard<
	TCandidate extends StaticMaterialBatchCandidate,
> {
	/** Returns whether the current slice can accept this candidate as-is. */
	canAddCandidate(candidate: TCandidate): boolean;
	/** Records a candidate that has been appended to the current slice. */
	acceptCandidate(candidate: TCandidate): void;
	/** Clears per-slice state after a new slice is opened. */
	reset(): void;
}

export function sliceStaticMaterialBatchCandidates<
	TCandidate extends StaticMaterialBatchCandidate,
>(options: {
	readonly candidates: readonly TCandidate[];
	/** Optional domain-specific incremental legality guard for one active slice. */
	readonly createSliceGuard?: () => StaticMaterialBatchSliceGuard<TCandidate>;
	readonly maxMaterialEntriesPerSlice: number;
}): readonly StaticMaterialBatchSlice<TCandidate>[] {
	const candidatesByBatch = groupByBatch(options.candidates);

	return [...candidatesByBatch.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([batchKey, group], batchIndex) =>
			createBatchSlices({
				candidates: group,
				batchIndex,
				batchKey,
				createSliceGuard: options.createSliceGuard,
				maxMaterialEntriesPerSlice: options.maxMaterialEntriesPerSlice,
			}),
		);
}

function groupByBatch<TCandidate extends StaticMaterialBatchCandidate>(
	candidates: readonly TCandidate[],
): Map<string, readonly TCandidate[]> {
	const groups = new Map<string, TCandidate[]>();

	for (const candidate of candidates) {
		const group = groups.get(candidate.batchKey);
		if (group) {
			group.push(candidate);
		} else {
			groups.set(candidate.batchKey, [candidate]);
		}
	}

	return groups;
}

function createBatchSlices<
	TCandidate extends StaticMaterialBatchCandidate,
>(options: {
	readonly candidates: readonly TCandidate[];
	readonly batchKey: string;
	readonly batchIndex: number;
	readonly createSliceGuard?: () => StaticMaterialBatchSliceGuard<TCandidate>;
	readonly maxMaterialEntriesPerSlice: number;
}): readonly StaticMaterialBatchSlice<TCandidate>[] {
	const slices: TCandidate[][] = [];
	let currentSlice: TCandidate[] = [];
	let currentMaterialKeys = new Set<string>();
	const sliceGuard = options.createSliceGuard?.() ?? null;

	for (const candidate of options.candidates) {
		if (
			currentSlice.length > 0 &&
			((!currentMaterialKeys.has(candidate.materialEntryKey) &&
				currentMaterialKeys.size >= options.maxMaterialEntriesPerSlice) ||
				sliceGuard?.canAddCandidate(candidate) === false)
		) {
			slices.push(currentSlice);
			currentSlice = [];
			currentMaterialKeys = new Set<string>();
			sliceGuard?.reset();
		}

		currentSlice.push(candidate);
		currentMaterialKeys.add(candidate.materialEntryKey);
		sliceGuard?.acceptCandidate(candidate);
	}

	if (currentSlice.length > 0) {
		slices.push(currentSlice);
	}

	return slices.map((slice, sliceIndex) => ({
		candidates: slice,
		batchIndex: options.batchIndex,
		batchKey: options.batchKey,
		sliceId: `slice/${options.batchIndex}/${sliceIndex}`,
		sliceIndex,
	}));
}
