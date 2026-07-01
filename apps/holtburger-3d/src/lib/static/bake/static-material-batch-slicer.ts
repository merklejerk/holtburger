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

export function sliceStaticMaterialBatchCandidates<
	TCandidate extends StaticMaterialBatchCandidate,
>(options: {
	/**
	 * Optional domain-specific legality check. It receives the current slice and
	 * the next candidate before the candidate is appended.
	 */
	readonly canAddCandidateToSlice?: (
		currentSlice: readonly TCandidate[],
		candidate: TCandidate,
	) => boolean;
	readonly candidates: readonly TCandidate[];
	readonly maxMaterialEntriesPerSlice: number;
}): readonly StaticMaterialBatchSlice<TCandidate>[] {
	const candidatesByBatch = groupByBatch(options.candidates);

	return [...candidatesByBatch.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([batchKey, group], batchIndex) =>
			createBatchSlices({
				canAddCandidateToSlice: options.canAddCandidateToSlice,
				candidates: group,
				batchIndex,
				batchKey,
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
	readonly canAddCandidateToSlice?: (
		currentSlice: readonly TCandidate[],
		candidate: TCandidate,
	) => boolean;
	readonly candidates: readonly TCandidate[];
	readonly batchKey: string;
	readonly batchIndex: number;
	readonly maxMaterialEntriesPerSlice: number;
}): readonly StaticMaterialBatchSlice<TCandidate>[] {
	const slices: TCandidate[][] = [];
	let currentSlice: TCandidate[] = [];
	let currentMaterialKeys = new Set<string>();

	for (const candidate of options.candidates) {
		if (
			currentSlice.length > 0 &&
			((!currentMaterialKeys.has(candidate.materialEntryKey) &&
				currentMaterialKeys.size >= options.maxMaterialEntriesPerSlice) ||
				options.canAddCandidateToSlice?.(currentSlice, candidate) === false)
		) {
			slices.push(currentSlice);
			currentSlice = [];
			currentMaterialKeys = new Set<string>();
		}

		currentSlice.push(candidate);
		currentMaterialKeys.add(candidate.materialEntryKey);
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
